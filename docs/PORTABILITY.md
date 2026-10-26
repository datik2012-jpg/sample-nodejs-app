# Deploy to another Kubernetes cluster or cloud

The Node.js application and its Deployment/Service/probes can run in another Kubernetes cluster. The existing Terraform provisions **AWS only**; changing `aws-region` will not provision Azure, GCP or another cloud.

This guide deploys the application to an **existing independent cluster**, with separate namespace and release ownership. It is a template for a new environment, not a claim that AKS/GKE provisioning or their CI authentication has been implemented or tested.

## What must change?

| Current AWS component | Replacement outside this AWS environment |
|---|---|
| EKS Terraform | Provider-specific cluster/network/IAM configuration, or an existing cluster |
| Private ECR image | An accessible registry such as ACR, Artifact Registry or your private registry |
| Node ECR pull permissions | Target cloud's registry integration, or an image pull Secret |
| AWS OIDC publishing role | Target registry/cloud authentication in CI |
| AWS ALB controller and annotations | A supported Ingress implementation in the target cluster |
| AWS Pod Identity | Target cloud workload identity, only for workloads that need cloud API access |
| Existing Argo CD destination | Target cluster registered with Argo CD, or a separate Argo CD installation |

Do not install the AWS Load Balancer Controller or copy the AWS ALB annotations into an unrelated cloud. The API needs no AWS credentials to serve requests.

## 1. Prerequisites

- An existing Linux/amd64 Kubernetes cluster with sufficient capacity for the chart's requests, and credentials in kubeconfig.
- `kubectl`, Helm, Docker and Git. The examples use PowerShell.
- A private image repository where you are already authenticated to push.
- Pull access from the target cluster to that registry. Configure your cloud's native registry integration or the Secret described below.
- Choose an explicit target context. Do not use the original `sample-nodejs-staging` for this independent demonstration.

Clone the app and enter its directory:

```powershell
git clone --branch develop https://github.com/datik2012-jpg/sample-nodejs-app.git
cd sample-nodejs-app

kubectl config get-contexts
$TargetContext = Read-Host "Enter the target Kubernetes context"
$ImageRepository = Read-Host "Enter your registry/repository without a tag"
$ImageTag = git rev-parse HEAD
```

For an ARM-only cluster, build for `linux/arm64` instead and confirm all selected images support that platform. This example explicitly builds amd64.

## 2. Build and push your image

Authenticate Docker to your selected registry using that provider's documented login procedure first. Then:

```powershell
docker build --platform linux/amd64 -t "${ImageRepository}:$ImageTag" .
if ($LASTEXITCODE -ne 0) { throw "Docker build failed" }

docker push "${ImageRepository}:$ImageTag"
if ($LASTEXITCODE -ne 0) { throw "Docker push failed" }
```

## 3. Review the portable values

Use [examples/values-portable.yaml](examples/values-portable.yaml). It disables Ingress and Gateway API resources initially, uses ClusterIP and expects the image repository/tag as command-line values.

```powershell
helm lint ./helm/sample-nodejs-app -f ./docs/examples/values-portable.yaml `
  --set-string "image.repository=$ImageRepository" `
  --set-string "image.tag=$ImageTag"

helm template sample-nodejs-app ./helm/sample-nodejs-app `
  --namespace sample-nodejs-demo `
  -f ./docs/examples/values-portable.yaml `
  --set-string "image.repository=$ImageRepository" `
  --set-string "image.tag=$ImageTag"
```

Inspect the rendered image and manifests before proceeding. Do not supply `values-staging.yaml`: it contains the original AWS Ingress settings.

## 4. Configure image pull access

If native registry integration is already configured for the nodes, leave `imagePullSecrets: []`.

Otherwise, create namespace `sample-nodejs-demo` in the selected context and a registry Secret named `registry-credentials` there using your registry's supported credential mechanism. Do not commit registry credentials. In your local values file set:

```yaml
imagePullSecrets:
  - name: registry-credentials
```

Use that edited file in place of the example values path in the commands below. Image pull Secrets are namespace-scoped and must exist before the Pods can pull the image.

## 5. Install in the independent cluster

This is the **direct Helm installation option**. Do not use it for the existing Argo CD-managed AWS application.

```powershell
helm upgrade --install sample-nodejs-app ./helm/sample-nodejs-app `
  --kube-context "$TargetContext" `
  --namespace sample-nodejs-demo `
  --create-namespace `
  -f ./docs/examples/values-portable.yaml `
  --set-string "image.repository=$ImageRepository" `
  --set-string "image.tag=$ImageTag" `
  --wait --timeout 5m
```

```powershell
kubectl --context "$TargetContext" -n sample-nodejs-demo get pods
kubectl --context "$TargetContext" -n sample-nodejs-demo rollout status deployment/sample-nodejs-app
helm test sample-nodejs-app --kube-context "$TargetContext" --namespace sample-nodejs-demo --logs
kubectl --context "$TargetContext" -n sample-nodejs-demo port-forward svc/sample-nodejs-app 8080:8080
```

Open `http://localhost:8080/my-app`. Here `helm test` is appropriate because Helm owns this newly installed release.

## 6. Add external access for that cluster

First install or enable a supported Ingress controller and verify its IngressClass:

```powershell
kubectl --context "$TargetContext" get ingressclass
```

Copy the portable values to an environment-specific file. Set `ingress.enabled: true`, set `className` to an actual installed class, configure its provider-specific annotations and your host/path. Configure DNS and TLS according to that controller. An Ingress object alone does not install a controller or create working external access.

## 7. Use Argo CD instead of direct Helm

For the assignment's GitOps deployment, commit the target environment's values and image tag into Git. Register the target cluster in Argo CD (or install Argo CD in that cluster). Create an Application using:

- `source.repoURL`: your app fork.
- `source.path`: `helm/sample-nodejs-app`.
- `source.targetRevision`: your chosen deployment branch.
- `source.helm.valueFiles`: the target values file, relative to the chart root. Move the example into the chart as a separate values file for this approach.
- `destination.server`: the registered target cluster address; `https://kubernetes.default.svc` means the cluster hosting that Argo CD instance.
- `destination.namespace`: `sample-nodejs-demo` (create it first or enable namespace creation).
- Application name / Helm release name: keep it consistent with the intended resource names.

For a fresh GitOps deployment, let Argo CD create and manage the app instead of first running the direct Helm installation above. For migration of an existing release, review resource names, ownership and Diff explicitly.

Update CI to publish to the new registry and update the new environment's values path. Also update the current change-detection rule: it only recognizes the original `values-staging.yaml` path. None of those pipeline changes happen automatically from editing a Helm image value.

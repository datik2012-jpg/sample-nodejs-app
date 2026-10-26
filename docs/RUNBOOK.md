# AWS staging runbook

Commands use PowerShell. Read the working-directory notes: the app and infrastructure repositories are separate checkouts. This runbook documents the existing lab, not a turnkey bootstrap into a new AWS account.

## Environment

| Setting | Value |
|---|---|
| AWS region | `eu-central-1` |
| Local AWS profile | `eks-lab` |
| EKS cluster | `sample-nodejs-staging-eks` |
| kubectl context | `sample-nodejs-staging` |
| Application namespace | `staging` |
| Argo CD namespace | `argocd` |
| Image repository | `438465166774.dkr.ecr.eu-central-1.amazonaws.com/sample-nodejs-app-ecr-registry` |

## 1. Authenticate from a workstation

```powershell
$env:AWS_PROFILE = "eks-lab"
$env:AWS_REGION = "eu-central-1"
aws sts get-caller-identity --profile eks-lab
```

If that configured login session expired:

```powershell
aws login --profile eks-lab --region eu-central-1 --remote
```

Open the URL printed by AWS CLI in a browser and complete login as the intended IAM user (`eks-lab-login` in this lab), then return the authorization code to the CLI if requested. Do not sign in as root for normal lab operations.

The profile must already exist and the user must have the relevant IAM permissions. Profile names are local aliases; they do not create AWS permissions.

For a new workstation with authorized access to this existing cluster:

```powershell
aws eks update-kubeconfig --name sample-nodejs-staging-eks --region eu-central-1 --profile eks-lab --alias sample-nodejs-staging
kubectl --context sample-nodejs-staging get nodes
```

The workstation's public IP must be allowed by `admin_public_cidr`. A changed home IP can cause API timeouts even when login succeeds.

## 2. Resume worker nodes

In the **infrastructure** checkout, inspect `git status` before switching branches. Retain any deliberate local pause settings until you decide to resume.

In `environments/staging/nodes.tf`, set:

```hcl
scaling_config {
  desired_size = 2
  min_size     = 2
  max_size     = 3
}
```

From the infra repository root:

```powershell
terraform -chdir=environments/staging init
terraform -chdir=environments/staging validate
terraform -chdir=environments/staging plan
```

Review the plan. For resuming an existing paused cluster, expect a node group scaling update, not unrelated destruction/replacement. Then:

```powershell
terraform -chdir=environments/staging apply
kubectl --context sample-nodejs-staging get nodes -w
```

Use `Ctrl+C` to stop watching after nodes are Ready. Existing Deployments/ReplicaSets and system controllers will schedule their Pods onto the new nodes; there is no need to reinstall the application for a node-only pause.

## 3. Verify the resumed environment

```powershell
kubectl --context sample-nodejs-staging -n kube-system get pods
kubectl --context sample-nodejs-staging -n argocd get pods
kubectl --context sample-nodejs-staging -n staging get pods -o wide
kubectl --context sample-nodejs-staging -n staging rollout status deployment/sample-nodejs-app
kubectl --context sample-nodejs-staging -n staging get ingress sample-nodejs-app
```

Open `http://<ADDRESS>/my-app` using the Ingress ADDRESS, not its root path. New ALB targets may take time to become healthy after node recreation.

## 4. Open Argo CD

Keep this terminal running:

```powershell
kubectl --context sample-nodejs-staging -n argocd port-forward svc/argocd-server 8443:443
```

Open `https://localhost:8443`. Use your configured admin credentials. Only if the initial password has not been changed and its Secret still exists, retrieve it in a second terminal:

```powershell
$encodedPassword = kubectl --context sample-nodejs-staging -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}'
[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($encodedPassword))
```

Do not put that output in Git or screenshots. The initial Secret is not a password recovery method after the admin password has changed.

In `sample-nodejs-app`, use **Refresh** to recompute comparison and **Diff** to inspect it. **Sync** applies Git's desired manifests. Auto-sync is currently off. For normal image updates, leave Force and Replace off; review any intended deletions before enabling Prune.

## 5. Deliver a change

In the **application** checkout, start with a clean worktree:

```powershell
git fetch origin
git switch develop
git branch --set-upstream-to=origin/develop develop
git pull --ff-only
git switch -c feature/your-change
```

Commit/push your change, open a PR to `develop`, review checks and merge. The develop workflow publishes a scanned image and opens a separate staging-tag PR. Review/approve its workflow if GitHub requests it, wait for checks and merge. Then Refresh/Diff/Sync in Argo CD and verify rollout and the ALB URL.

Do not run `helm upgrade` or `helm uninstall` against the Argo CD-managed application. Helm still installs the infrastructure tools themselves, such as Argo CD and the ALB controller.

## 6. Run the chart's in-cluster health test

The live AWS application is managed by Argo CD, which renders the chart but does not update the old manual Helm release record. Therefore `helm test` on that old release can run stale templates. Render and create the current test Pod instead.

In an up-to-date **application** checkout:

```powershell
helm template sample-nodejs-app ./helm/sample-nodejs-app --namespace staging -f ./helm/sample-nodejs-app/values-staging.yaml --show-only templates/tests/test-connection.yaml |
  kubectl --context sample-nodejs-staging -n staging create -f -

kubectl --context sample-nodejs-staging -n staging wait --for=jsonpath='{.status.phase}'=Succeeded pod/sample-nodejs-app-test-connection --timeout=90s
kubectl --context sample-nodejs-staging -n staging logs sample-nodejs-app-test-connection
```

This downloads `/ready` through the ClusterIP Service. A successful test exits as `Succeeded`; wget may save the response to a file rather than print `Ready`. After reviewing success:

```powershell
kubectl --context sample-nodejs-staging -n staging delete pod sample-nodejs-app-test-connection
```

If the test name already exists, inspect its status and logs before deleting the previous test Pod and retrying. The test image currently uses the unpinned `busybox` tag.

## 7. Pause worker nodes

Set only the scaling values in infra `environments/staging/nodes.tf` to:

```hcl
scaling_config {
  desired_size = 0
  min_size     = 0
  max_size     = 3
}
```

```powershell
terraform -chdir=environments/staging plan
terraform -chdir=environments/staging apply
kubectl --context sample-nodejs-staging get nodes
```

Managed worker EC2 instances are terminated, not suspended. Resume creates new instances. Application and Argo CD Pods are unavailable while no workers exist. Do not manually stop individual Auto Scaling-managed instances, since replacements may be launched.

EKS control plane, NAT, ALB and applicable storage/network resources continue billing. Scaling workers to zero does not make this environment free. Do not commit temporary pause settings accidentally with unrelated infrastructure work.

## 8. Rebuild or remove the whole environment

Full teardown/rebuild is different from pausing workers. The present Terraform is account-specific: the S3 backend, provisioner role, EKS access principal and AWS account ID are embedded in configuration. The state bucket and provisioner access must exist before staging init/apply.

For a fresh account, configure those prerequisites and review `bootstrap`, provider account/role settings, access entries and backend bucket/key before running Terraform. ECR and the GitHub publishing role also require separate setup; they are not all provisioned by this staging module. Do not migrate another person's state into your account.

After a full rebuild: apply Terraform, generate kubeconfig, update the controller's VPC ID, install the controller using the infra repository's saved Helm instructions, install Argo CD and apply its Application. These steps are not yet a single automated bootstrap.

Argo CD installation from the **infra root**, after verifying access to the intended recreated cluster:

```powershell
helm repo add argo https://argoproj.github.io/argo-helm
helm repo update argo
helm upgrade --install argocd argo/argo-cd --version 10.11.1 --kube-context sample-nodejs-staging --namespace argocd --create-namespace --values ./argocd/values-staging.yaml --wait --timeout 10m
kubectl --context sample-nodejs-staging create namespace staging --dry-run=client -o yaml | kubectl --context sample-nodejs-staging apply -f -
kubectl --context sample-nodejs-staging apply -f ./argocd/sample-nodejs-staging.yaml
```

Open Argo CD, review Diff and Sync. Recheck pinned tool versions and controller/cluster compatibility when rebuilding later; these are the lab's installation versions.

Before full teardown, remove the application's Ingress while the controller and workers are still running, and verify AWS ALB and controller-managed resources have been cleaned up. With the current manual sync, do not Sync the Application again during teardown. If enabling auto-sync later, disable it or change Git's desired state before removal. Only then review a Terraform destroy plan for the correct staging state. Avoid deleting the controller before it can clean up ALB resources. Preserve required state and submission evidence.

## Troubleshooting

| Symptom | First checks |
|---|---|
| AWS login expired | Refresh `eks-lab` login and confirm `sts get-caller-identity` |
| Terraform tries `169.254.169.254` on the laptop | Check AWS profile/credentials in that terminal; it fell back to EC2 metadata |
| API timeout | Check administrator public `/32`, network reachability and cluster status |
| `No configuration files` | Run Terraform with `-chdir=environments/staging` from the infra root |
| Missing staging values after branch switch | `git branch -vv`, `git fetch origin`, correct develop tracking, then merge/update intentionally |
| `ImagePullBackOff` | Pod events, exact repository/tag existence, node registry permissions and network access |
| ALB hostname absent | Ingress events and controller logs; check IAM/Pod Identity and subnet discovery |
| ALB 503 | Target health, Pod readiness, endpoint selection and controller logs |
| `/` returns 404 | Use `/my-app`; the API does not define `/` |

```powershell
kubectl --context sample-nodejs-staging -n staging describe ingress sample-nodejs-app
kubectl --context sample-nodejs-staging -n staging get endpointslices -l kubernetes.io/service-name=sample-nodejs-app
kubectl --context sample-nodejs-staging -n kube-system logs deployment/aws-load-balancer-controller --tail=100
kubectl --context sample-nodejs-staging -n staging logs deployment/sample-nodejs-app --tail=100
```

# Submission evidence

Add real screenshots after resuming and verifying the lab. This directory is a checklist; the screenshots below have not yet been committed. Do not represent a Mermaid diagram as runtime evidence.

| Suggested filename | What the screenshot should show |
|---|---|
| `01-ci-security.png` | A successful develop workflow: tests, Snyk, Docker/Trivy and ECR publication |
| `02-image-pr.png` | The bot-created PR changing only the staging image tag |
| `03-argocd.png` | Argo CD Synced + Healthy, two API Pods and the Ingress |
| `04-ingress-browser.png` | Browser URL ending in `/my-app` through the ALB and `Hello, World!` |
| `05-runtime.png` | Explicit-context kubectl output showing Ready nodes, running API Pods and Ingress address |

## Capture commands

```powershell
kubectl --context sample-nodejs-staging get nodes
kubectl --context sample-nodejs-staging -n staging get pods -o wide
kubectl --context sample-nodejs-staging -n staging get ingress
kubectl --context sample-nodejs-staging -n staging rollout status deployment/sample-nodejs-app
```

On Windows, use `Win+Shift+S` to capture the relevant area, then save the image in this directory. Exclude passwords, tokens, secret values and browser authorization codes.

After saving a file, embed it in Markdown using a relative path, for example:

```markdown
![Argo CD shows the staging application Synced and Healthy](03-argocd.png)
```

Keep evidence from a consistent verified deployment. Date the capture and record the deployed image tag in the PR description or submission notes. A paused lab can retain screenshots, but the live endpoint will not serve the application until workers are resumed.

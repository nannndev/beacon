# Git-backed Projects

Git-backed projects turn one Beacon project into readable files that can live beside application code or in a dedicated repository. This is the recommended collaboration mode for teammates who do not need the same LAN host to remain online.

No Beacon account or GitHub OAuth is required. Beacon uses the Git installation, SSH keys, and credential manager already configured on the device.

## What Beacon stores

The linked folder contains project source that is safe to review and commit:

```text
checkout-api/
├── beacon.yaml
├── endpoints/
│   └── login--3f8a2c.yaml
├── environments/
│   └── local--178b4a.yaml
├── .beacon/
│   └── environments.local.yaml
└── .gitignore
```

Beacon stores endpoint definitions, folders, assertions, extractors, and test configuration in YAML. Values whose names look sensitive, including tokens, passwords, cookies, API keys, and credentials, are written to `.beacon/environments.local.yaml`. The `.beacon/` directory is automatically ignored by Git.

Responses, logs, run history, generated values, and active cookies remain in the local Beacon workspace.

## Link the current project

1. Open the project and select **Project Settings**.
2. In **Git-backed project files**, select **Link folder**.
3. Choose an empty folder or a safe location inside an existing repository.
4. Review the generated `beacon.yaml`, `endpoints/`, `environments/`, and `.gitignore` files.
5. Select **Initialize Git** if the folder is not already a repository.

Beacon will not overwrite a folder that already contains `beacon.yaml` or conflicting Beacon resource directories.

## Import from a repository

Open **Import**, choose the repository source, enter its Git URL, and choose a destination folder.

- If the repository contains `beacon.yaml`, Beacon opens it as a linked project.
- Otherwise Beacon safely scans supported data files and offers import candidates for OpenAPI 3, Swagger 2, Postman, Insomnia, HAR, JSON, and YAML.
- If no supported API definition is found, Beacon can initialize a new project inside the cloned repository.

Repository inspection reads supported data files only. It does not install dependencies or execute repository code.

## Review and commit changes

The Git section shows the current branch, upstream state, and changed managed files. Expand **Changes** to inspect each patch before committing.

1. Enter a short commit message.
2. Select **Commit**. Beacon stages only `beacon.yaml`, `endpoints/`, `environments/`, and `.gitignore`.
3. Select **Push** to publish the branch.

You can also use GitHub Desktop, an IDE, or the Git CLI. The on-disk format is not tied to Beacon's built-in controls.

## Pull and push

Beacon uses the existing `origin` remote and device credentials.

- **Pull** accepts fast-forward updates only. Commit or resolve local project changes first.
- **Push** publishes the current branch. The first push sets its upstream automatically.
- **Fetch** refreshes remote branch information without switching the project.

If authentication fails in Beacon but works in a terminal, make sure the desktop process can access the same SSH agent or credential manager. An HTTPS origin can use credentials configured through Git Credential Manager or GitHub CLI.

## Branches

Project Settings can fetch, create, compare, and switch branches.

Before switching, Beacon shows:

- Commits unique to the current and target branch.
- Added, modified, and deleted managed project files.
- Line additions and deletions.

Switching is blocked when any file in the repository is dirty, including files Beacon does not manage. Beacon also verifies that the destination branch contains a supported `beacon.yaml` with the same stable project ID. After switching, the project is reloaded from YAML.

## Git sync or LAN sharing?

Use Git-backed projects for asynchronous work, code review, branches, and remote teams. Use [local project sharing](../superpowers/specs/2026-07-25-local-project-sharing-design.md) for a live session between trusted devices on the same network.

In both modes, each device runs its own requests and keeps its own private values and history.

## Safety rules

- Review `.gitignore` before the first commit and never add `.beacon/` to Git.
- Do not force-push or merge from Beacon. Use a full Git client for history-rewriting or conflict resolution.
- Resolve external file changes before asking Beacon to write the linked project again.
- Use load and rate-limit modes only against systems you own or are authorized to test.

# Projects & Environments

A **Project** in Beacon is a container for your API work.

Each project contains:
- Multiple **Environments** (Local, Staging, Production, etc.)
- A collection of **Endpoints** organized in folders
- Global and environment-specific variables

## Environments

Environments allow you to switch base URLs and variables easily.

Example environments:
- Local → `http://localhost:3000`
- Production → `https://api.example.com`

Variables defined in environments are merged with global variables.

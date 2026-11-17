# Postman Import

Beacon has first-class support for importing Postman collections.

## How to Import

1. Go to the project you want to import into
2. Click **Import** in the header
3. Choose your `.postman_collection.json` file
4. Beacon will automatically convert:
   - Folders → Folders (preserves nesting)
   - Requests → Endpoints
   - Variables → Environments (where possible)
   - Headers & Body → Correct format

## What Gets Imported

| Postman          | Beacon                  |
|------------------|-------------------------|
| Folders          | Folders (nested)        |
| Requests         | Endpoints               |
| Headers          | Headers                 |
| Body (JSON/Form) | Payload                 |
| Variables        | Environment variables   |

## Limitations

- Scripts (Pre-request / Tests) are not imported
- Some advanced auth types may need manual setup
- File uploads in multipart need to be re-attached

## Recommended Workflow

1. Export your collection from Postman
2. Import into Beacon
3. Reorganize if needed using folders
4. Add dynamic variables (`{{random_email}}`, etc.)
5. Set up extractors for token chaining

Next: [Variables & Templating](/features/variables)

## Import from source code

Beacon AI can build a project straight from a codebase. In the agent chat, ask
for example:

- "analisa ~/code/shop-api lalu jadikan project"
- "import repo acme/shop-api"
- "make a collection from https://github.com/acme/shop-api/tree/develop"

The agent scans routes (Express, Fastify, Hono, NestJS, Next.js, FastAPI, Flask,
Django, Laravel, Go, Axum, Rocket) and any OpenAPI/Swagger files,
summarizes the frameworks, modules, and auth, then creates a project with a
folder per module and a `base_url` environment. Ask it to fix names, folders, or
request bodies before importing, or to add the endpoints to the current project.

GitHub repositories need GitHub connected in **Settings** with a personal access
token. Very large repositories are sampled (up to 45 code files), so check the
result for missing routes.


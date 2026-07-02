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

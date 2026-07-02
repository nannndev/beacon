# Folders & Organization

Beacon supports a full hierarchical folder structure, very similar to Postman collections.

## Why Folders Matter

- Keep your APIs organized by domain, feature, or flow
- Run entire groups of endpoints with one click
- Maintain clean structure even with hundreds of endpoints
- Postman imports preserve your existing folder layout

## Creating and Managing Folders

- Click **New Folder** in the endpoint list
- You can create folders inside folders (deep nesting supported)
- Folders can contain both endpoints and other folders

## Running Folders

When you click the **Run** button on a folder, Beacon will:

1. Recursively collect **all** requests inside that folder
2. Include requests from all subfolders
3. Execute them according to your current run settings

This is extremely useful for:
- Running all authentication flows together
- Testing a complete feature area
- Load testing an entire module

## Folder Structure in Storage

Internally, Beacon stores endpoints in a recursive `items` array (not a flat list). This makes importing/exporting and future features (like moving folders) much cleaner.

## Best Practices

- Group by business domain (Auth, Users, Orders, Payments...)
- Use subfolders for complex flows (e.g., Auth → Login, Auth → Refresh)
- Keep related extractors near the endpoints that produce them

Next: [Postman Import](./postman-import.md)

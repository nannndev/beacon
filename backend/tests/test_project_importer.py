import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routers.projects import router
from backend.app.services.project_importer import ProjectImportError, normalize_project


class ProjectImporterTests(unittest.TestCase):
    def test_beacon_round_trip_preserves_endpoint_features(self):
        report = normalize_project({
            "format": "security-tools.project", "version": 1,
            "project": {"name": "Beacon Demo", "environments": [], "items": [{
                "type": "request", "name": "Login", "url": "/login", "method": "POST",
                "payload": {"email": "{{random_email}}"}, "extractors": {"token": "body.token"},
                "assertions": [{"type": "status", "op": "eq", "value": 200}],
            }]},
        })
        endpoint = report["project"]["items"][0]
        self.assertEqual(report["format"], "beacon")
        self.assertEqual(endpoint["extractors"], {"token": "body.token"})
        self.assertEqual(len(endpoint["assertions"]), 1)

    def test_postman_converts_folders_auth_graphql_and_warns_about_scripts(self):
        report = normalize_project({
            "info": {"name": "Shop", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
            "variable": [{"key": "host", "value": "https://example.com"}],
            "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{token}}"}]},
            "event": [{"listen": "prerequest"}],
            "item": [{"name": "Graph", "request": {"method": "POST", "url": "{{host}}/graphql", "body": {"mode": "graphql", "graphql": {"query": "query Ping { ping }", "variables": "{}"}}}}],
        })
        endpoint = report["project"]["items"][0]
        self.assertEqual(endpoint["headers"]["Authorization"], "Bearer {{token}}")
        self.assertEqual(endpoint["payload"]["query"], "query Ping { ping }")
        self.assertTrue(any("script" in warning for warning in report["warnings"]))

    def test_openapi_yaml_builds_tag_folder_server_and_examples(self):
        report = normalize_project({"content": """
openapi: 3.0.3
info: {title: Store API}
servers:
  - url: https://{region}.example.com
    variables: {region: {default: eu}}
components:
  securitySchemes:
    bearerAuth: {type: http, scheme: bearer}
paths:
  /pets/{id}:
    get:
      tags: [Pets]
      summary: Get pet
      security: [{bearerAuth: []}]
      parameters:
        - {name: id, in: path, required: true, schema: {type: string}}
        - {name: verbose, in: query, schema: {type: boolean, default: true}}
""", "filename": "openapi.yaml"})
        project = report["project"]
        endpoint = project["items"][0]["items"][0]
        self.assertEqual(project["environments"][0]["base_url"], "https://eu.example.com")
        self.assertIn("verbose=true", endpoint["url"])
        self.assertEqual(endpoint["headers"]["Authorization"], "Bearer {{access_token}}")

    def test_swagger_insomnia_and_har_are_detected(self):
        swagger = normalize_project({"swagger": "2.0", "info": {"title": "Old"}, "host": "api.example.com", "paths": {"/ping": {"get": {}}}})
        self.assertEqual(swagger["format"], "swagger2")

        insomnia = normalize_project({"_type": "export", "resources": [
            {"_id": "wrk", "_type": "workspace", "name": "Insomnia Demo"},
            {"_id": "req", "_type": "request", "parentId": "wrk", "name": "Ping", "url": "https://example.com/ping", "method": "GET"},
        ]})
        self.assertEqual(insomnia["summary"]["endpoints"], 1)

        har = normalize_project({"log": {"entries": [{"request": {"method": "GET", "url": "https://example.com/ping", "headers": []}}]}})
        self.assertEqual(har["format"], "har")
        self.assertTrue(har["warnings"])

    def test_unknown_empty_and_future_beacon_files_are_rejected(self):
        for source in ({"hello": "world"}, {"format": "security-tools.project", "version": 1, "project": {"items": []}}, {"format": "security-tools.project", "version": 99, "project": {"items": []}}):
            with self.subTest(source=source):
                with self.assertRaises(ProjectImportError):
                    normalize_project(source)

    def test_preview_route_reads_raw_file_envelope_from_request_body(self):
        app = FastAPI()
        app.include_router(router)
        response = TestClient(app).post("/projects/import/preview", json={
            "content": '{"swagger":"2.0","info":{"title":"Route API"},"paths":{"/ping":{"get":{}}}}',
            "filename": "swagger.json",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["format"], "swagger2")
        self.assertEqual(response.json()["summary"]["endpoints"], 1)


if __name__ == "__main__":
    unittest.main()

import unittest

from backend.app.cli_runner import _dynamic_template_error
from backend.app.core.templating import TemplateResolver

class NewGeneratorTests(unittest.TestCase):
    def test_new_generators_resolve(self):
        resolver = TemplateResolver({})
        name = resolver.resolve("{{random_name}}")
        self.assertRegex(name, r"^\w+ \w+$")
        self.assertIn(resolver.resolve("{{random_bool}}"), {"true", "false"})
        self.assertRegex(resolver.resolve("{{iso_date}}"), r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
        for _ in range(20):
            self.assertIn(resolver.resolve("{{random_choice:Paid|Pending}}"), {"Paid", "Pending"})

    def test_empty_choice_and_cli_validation(self):
        self.assertEqual(TemplateResolver.generate("random_choice:"), "")
        for token in ("random_name", "random_bool", "iso_date", "random_choice:a|b"):
            self.assertIsNone(_dynamic_template_error(token), token)
        self.assertIsNotNone(_dynamic_template_error("random_choice:"))

if __name__ == "__main__":
    unittest.main()

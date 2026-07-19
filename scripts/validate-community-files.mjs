import { readFile } from 'node:fs/promises'
import YAML from 'yaml'

const markdownFiles = [
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'SECURITY.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
]

const issueForms = [
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/documentation.yml',
  '.github/ISSUE_TEMPLATE/testing_report.yml',
]

async function read(path) {
  return readFile(new URL('../' + path, import.meta.url), 'utf8')
}

for (const path of markdownFiles) {
  const content = await read(path)
  if (content.trim().length < 120) {
    throw new Error(path + ' is unexpectedly short')
  }
}

for (const path of issueForms) {
  const document = YAML.parseDocument(await read(path))
  if (document.errors.length > 0) {
    throw new Error(path + ': ' + document.errors.map((error) => error.message).join('; '))
  }
  const form = document.toJS()
  if (
    typeof form.name !== 'string' ||
    typeof form.description !== 'string' ||
    !Array.isArray(form.body) ||
    form.body.length < 3
  ) {
    throw new Error(path + ' is missing required issue-form fields')
  }
}

const configDocument = YAML.parseDocument(
  await read('.github/ISSUE_TEMPLATE/config.yml'),
)
if (configDocument.errors.length > 0) {
  throw new Error(configDocument.errors.map((error) => error.message).join('; '))
}
const config = configDocument.toJS()
const contactLinks = Array.isArray(config.contact_links) ? config.contact_links : []
if (
  !contactLinks.some(
    (link) =>
      typeof link?.url === 'string' &&
      link.url === 'https://github.com/nannndev/beacon/security/advisories/new',
  )
) {
  throw new Error('Issue chooser must link to private GitHub Security Advisories')
}

console.log('Community files valid: ' + (markdownFiles.length + issueForms.length + 1))

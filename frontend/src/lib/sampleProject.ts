import type { Project } from '../types'


export const JSONPLACEHOLDER_TEMPLATE_ID = 'jsonplaceholder-v1'

export function hasJsonPlaceholderSample(projects: Project[]): boolean {
  return projects.some(
    (project) => project.template_id === JSONPLACEHOLDER_TEMPLATE_ID,
  )
}

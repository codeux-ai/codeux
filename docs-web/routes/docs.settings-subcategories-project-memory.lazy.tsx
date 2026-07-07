import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesProjectMemoryContent from '../content/docs/settings-subcategories-project-memory.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-project-memory')({
  component: () => (
    <DocsPage id="settings-subcategories-project-memory">
      <SettingsSubcategoriesProjectMemoryContent />
    </DocsPage>
  )
})

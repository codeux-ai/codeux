import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesSystemMemoryContent from '../content/docs/settings-subcategories-system-memory.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-system-memory')({
  component: () => (
    <DocsPage id="settings-subcategories-system-memory">
      <SettingsSubcategoriesSystemMemoryContent />
    </DocsPage>
  )
})

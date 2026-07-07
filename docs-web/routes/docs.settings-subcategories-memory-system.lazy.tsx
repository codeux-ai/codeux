import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesMemorySystemContent from '../content/docs/settings-subcategories-memory-system.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-memory-system')({
  component: () => (
    <DocsPage id="settings-subcategories-memory-system">
      <SettingsSubcategoriesMemorySystemContent />
    </DocsPage>
  )
})

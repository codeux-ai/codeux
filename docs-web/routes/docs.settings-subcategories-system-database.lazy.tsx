import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesSystemDatabaseContent from '../content/docs/settings-subcategories-system-database.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-system-database')({
  component: () => (
    <DocsPage id="settings-subcategories-system-database">
      <SettingsSubcategoriesSystemDatabaseContent />
    </DocsPage>
  )
})

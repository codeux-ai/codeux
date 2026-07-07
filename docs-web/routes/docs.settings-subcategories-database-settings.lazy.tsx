import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesDatabaseSettingsContent from '../content/docs/settings-subcategories-database-settings.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-database-settings')({
  component: () => (
    <DocsPage id="settings-subcategories-database-settings">
      <SettingsSubcategoriesDatabaseSettingsContent />
    </DocsPage>
  )
})

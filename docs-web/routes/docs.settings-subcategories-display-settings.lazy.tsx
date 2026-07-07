import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesDisplaySettingsContent from '../content/docs/settings-subcategories-display-settings.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-display-settings')({
  component: () => (
    <DocsPage id="settings-subcategories-display-settings">
      <SettingsSubcategoriesDisplaySettingsContent />
    </DocsPage>
  )
})

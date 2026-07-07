import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesIntegrationsContent from '../content/docs/settings-subcategories-integrations.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-integrations')({
  component: () => (
    <DocsPage id="settings-subcategories-integrations">
      <SettingsSubcategoriesIntegrationsContent />
    </DocsPage>
  )
})

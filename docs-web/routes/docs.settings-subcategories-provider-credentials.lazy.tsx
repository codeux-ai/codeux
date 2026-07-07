import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesProviderCredentialsContent from '../content/docs/settings-subcategories-provider-credentials.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-provider-credentials')({
  component: () => (
    <DocsPage id="settings-subcategories-provider-credentials">
      <SettingsSubcategoriesProviderCredentialsContent />
    </DocsPage>
  )
})

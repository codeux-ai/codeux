import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesOverviewContent from '../content/docs/settings-subcategories-overview.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-overview')({
  component: () => (
    <DocsPage id="settings-subcategories-overview">
      <SettingsSubcategoriesOverviewContent />
    </DocsPage>
  )
})

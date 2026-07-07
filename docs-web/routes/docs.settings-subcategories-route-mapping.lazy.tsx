import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesRouteMappingContent from '../content/docs/settings-subcategories-route-mapping.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-route-mapping')({
  component: () => (
    <DocsPage id="settings-subcategories-route-mapping">
      <SettingsSubcategoriesRouteMappingContent />
    </DocsPage>
  )
})

import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesDefaultRoutingAnchorsContent from '../content/docs/settings-subcategories-default-routing-anchors.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-default-routing-anchors')({
  component: () => (
    <DocsPage id="settings-subcategories-default-routing-anchors">
      <SettingsSubcategoriesDefaultRoutingAnchorsContent />
    </DocsPage>
  )
})

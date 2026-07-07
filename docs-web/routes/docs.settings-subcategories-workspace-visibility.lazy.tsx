import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesWorkspaceVisibilityContent from '../content/docs/settings-subcategories-workspace-visibility.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-workspace-visibility')({
  component: () => (
    <DocsPage id="settings-subcategories-workspace-visibility">
      <SettingsSubcategoriesWorkspaceVisibilityContent />
    </DocsPage>
  )
})

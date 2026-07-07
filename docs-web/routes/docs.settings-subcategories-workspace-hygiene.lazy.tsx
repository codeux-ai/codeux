import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesWorkspaceHygieneContent from '../content/docs/settings-subcategories-workspace-hygiene.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-workspace-hygiene')({
  component: () => (
    <DocsPage id="settings-subcategories-workspace-hygiene">
      <SettingsSubcategoriesWorkspaceHygieneContent />
    </DocsPage>
  )
})

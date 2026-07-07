import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesGitFlowContent from '../content/docs/settings-subcategories-git-flow.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-git-flow')({
  component: () => (
    <DocsPage id="settings-subcategories-git-flow">
      <SettingsSubcategoriesGitFlowContent />
    </DocsPage>
  )
})

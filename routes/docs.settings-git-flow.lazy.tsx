import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsGitFlowContent from '../content/docs/settings-git-flow.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-git-flow')({
  component: () => (
    <DocsPage id="settings-git-flow">
      <SettingsGitFlowContent />
    </DocsPage>
  )
})

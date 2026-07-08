import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsGitHostConfigurationContent from '../content/docs/settings-git-host-configuration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-git-host-configuration')({
  component: () => (
    <DocsPage id="settings-git-host-configuration">
      <SettingsGitHostConfigurationContent />
    </DocsPage>
  )
})

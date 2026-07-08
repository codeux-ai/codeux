import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsJiraConfigurationContent from '../content/docs/settings-jira-configuration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-jira-configuration')({
  component: () => (
    <DocsPage id="settings-jira-configuration">
      <SettingsJiraConfigurationContent />
    </DocsPage>
  )
})

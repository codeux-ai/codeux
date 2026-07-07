import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesJiraConfigurationContent from '../content/docs/settings-subcategories-jira-configuration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-jira-configuration')({
  component: () => (
    <DocsPage id="settings-subcategories-jira-configuration">
      <SettingsSubcategoriesJiraConfigurationContent />
    </DocsPage>
  )
})

import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesGitHostConfigurationContent from '../content/docs/settings-subcategories-git-host-configuration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-git-host-configuration')({
  component: () => (
    <DocsPage id="settings-subcategories-git-host-configuration">
      <SettingsSubcategoriesGitHostConfigurationContent />
    </DocsPage>
  )
})

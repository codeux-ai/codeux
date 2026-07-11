import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsBaseProviderConfigurationContent from '../content/docs/settings-base-provider-configuration.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-base-provider-configuration')({
  component: () => (
    <DocsPage id="settings-base-provider-configuration">
      <SettingsBaseProviderConfigurationContent />
    </DocsPage>
  )
})

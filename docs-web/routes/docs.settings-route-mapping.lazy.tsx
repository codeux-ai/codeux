import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsRouteMappingContent from '../content/docs/settings-route-mapping.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-route-mapping')({
  component: () => (
    <DocsPage id="settings-route-mapping">
      <SettingsRouteMappingContent />
    </DocsPage>
  )
})

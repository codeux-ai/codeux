import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsDefaultRoutingAnchorsContent from '../content/docs/settings-default-routing-anchors.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-default-routing-anchors')({
  component: () => (
    <DocsPage id="settings-default-routing-anchors">
      <SettingsDefaultRoutingAnchorsContent />
    </DocsPage>
  )
})

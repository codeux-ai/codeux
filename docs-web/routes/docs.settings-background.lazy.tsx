import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsBackgroundContent from '../content/docs/settings-background.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-background')({
  component: () => (
    <DocsPage id="settings-background">
      <SettingsBackgroundContent />
    </DocsPage>
  )
})

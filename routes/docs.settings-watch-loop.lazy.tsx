import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsWatchLoopContent from '../content/docs/settings-watch-loop.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-watch-loop')({
  component: () => (
    <DocsPage id="settings-watch-loop">
      <SettingsWatchLoopContent />
    </DocsPage>
  )
})

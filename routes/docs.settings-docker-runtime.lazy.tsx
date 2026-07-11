import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsDockerRuntimeContent from '../content/docs/settings-docker-runtime.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-docker-runtime')({
  component: () => (
    <DocsPage id="settings-docker-runtime">
      <SettingsDockerRuntimeContent />
    </DocsPage>
  )
})

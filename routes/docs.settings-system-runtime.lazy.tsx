import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSystemRuntimeContent from '../content/docs/settings-system-runtime.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-system-runtime')({
  component: () => (
    <DocsPage id="settings-system-runtime">
      <SettingsSystemRuntimeContent />
    </DocsPage>
  )
})

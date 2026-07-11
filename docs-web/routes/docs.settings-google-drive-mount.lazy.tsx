import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsGoogleDriveMountContent from '../content/docs/settings-google-drive-mount.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-google-drive-mount')({
  component: () => (
    <DocsPage id="settings-google-drive-mount">
      <SettingsGoogleDriveMountContent />
    </DocsPage>
  )
})

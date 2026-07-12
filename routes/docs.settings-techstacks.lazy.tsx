import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsTechstacksContent from '../content/docs/settings-techstacks.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-techstacks')({
  component: () => (
    <DocsPage id="settings-techstacks">
      <SettingsTechstacksContent />
    </DocsPage>
  )
})

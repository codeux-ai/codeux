import { createLazyFileRoute } from '@tanstack/react-router'
import DeveloperSettingsReferenceContent from '../content/docs/developer-settings-reference.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/developer-settings-reference')({
  component: () => (
    <DocsPage id="developer-settings-reference">
      <DeveloperSettingsReferenceContent />
    </DocsPage>
  )
})

import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsQualityAssuranceContent from '../content/docs/settings-quality-assurance.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-quality-assurance')({
  component: () => (
    <DocsPage id="settings-quality-assurance">
      <SettingsQualityAssuranceContent />
    </DocsPage>
  )
})

import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsOnboardingContent from '../content/docs/settings-onboarding.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-onboarding')({
  component: () => (
    <DocsPage id="settings-onboarding">
      <SettingsOnboardingContent />
    </DocsPage>
  )
})

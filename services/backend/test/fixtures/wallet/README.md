# Test wallet

A self-signed organisation, generated once and committed so that every test which reads a
certificate and key off disk runs on a clean checkout instead of only after `pnpm fabric:start`
has produced the real crypto material.

The private key here is throwaway. No peer, channel, certificate authority or stakeholder registry
in this project has ever heard of `fixture.example.com`, so nothing signed with it is accepted
anywhere.

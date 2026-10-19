type LogoProps = { className?: string };

export function GoogleGLogo({ className = 'size-5' }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3a7.2 7.2 0 0 1-10.7-3.78H1.34v3.09A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.36 14.31a7.2 7.2 0 0 1 0-4.62V6.6H1.34a12 12 0 0 0 0 10.8l4.02-3.09z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.5 11.5 0 0 0 12 0 12 12 0 0 0 1.34 6.6l4.02 3.09A7.16 7.16 0 0 1 12 4.77z" />
    </svg>
  );
}

export function AnthropicLogo({ className = 'size-5' }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M13.8 3h3.6L24 21h-3.6L13.8 3zM6.6 3h3.7L17 21h-3.7l-1.4-3.7H5.2L3.8 21H0L6.6 3zm.1 11.2h4.2L8.8 8.6l-2.1 5.6z" />
    </svg>
  );
}

export function OpenAILogo({ className = 'size-5' }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.5l7.4 4.25v8.5L12 19.5l-7.4-4.25v-8.5L12 2.5z" />
      <path d="M12 2.5v8.9m0 0l7.4-4.65M12 11.4l-7.4-4.65M12 11.4v8.1M12 11.4l7.4 3.85M12 11.4L4.6 15.25" />
    </svg>
  );
}

export function NvidiaLogo({ className = 'size-5' }: LogoProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#76B900" d="M9 8.2V6.5c.2 0 .4-.1.6-.1 4.2-.1 7 3.6 7 3.6s-3 4.2-6.1 4.2c-.5 0-.9-.1-1.3-.2V9.8c1.6.2 1.9.9 2.9 2.5l2.1-1.8s-1.5-2-4-2.1c-.4 0-.8 0-1.2-.1zm0-4.5v2.6l.6-.1c5.200-.2 8.600 4.300 8.600 4.300s-3.900 4.800-8 4.800c-.4 0-.8 0-1.200-.1v1.500c.3 0 .6.1 1 .1 3.800 0 6.500-1.900 9.200-4.200.4.400 2.200 1.200 2.600 1.600-2.500 2.100-8.400 3.800-11.500 3.800-.3 0-.6 0-.9 0v1.800H24V3.700H9zm0 10.700v1.100c-3.700-.7-4.700-4.500-4.700-4.500s1.700-1.900 4.700-2.200v1.200c-1.600-.2-2.900.8-2.900.8s.7 2.100 2.900 3.600z" />
    </svg>
  );
}

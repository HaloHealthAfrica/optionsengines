import './globals.css';
import { inter } from './fonts';

export const metadata = {
  title: 'OptionAgents',
  description: 'Modern options trading platform',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans transition-colors duration-300">{children}</body>
    </html>
  );
}

import React from 'react';
import { Layout } from '../components/Layout';
import { AISearchWorkspace } from '../components/AISearchWorkspace';

export function Dashboard() {
  return (
    <Layout>
      <div className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">
        <AISearchWorkspace />
      </div>
    </Layout>
  );
}

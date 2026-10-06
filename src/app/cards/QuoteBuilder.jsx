import React from 'react';
import { hubspot } from '@hubspot/ui-extensions';
import { QuoteBuilderApp } from './QuoteBuilderApp.jsx';

hubspot.extend(() => <QuoteBuilderApp />);

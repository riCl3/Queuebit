const ink = await import('ink');
const React = await import('react');
const AppModule = await import('./App.mjs');
const App = AppModule.default || AppModule;

process.title = 'QueueBit';
process.stdout.write('\x1b]0;QueueBit\x07');

ink.render(React.createElement(App), {
	enterAltScreen: true,
	exitOnCtrlC: true
});

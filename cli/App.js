import React, { useState, useEffect, useRef, useMemo, memo } from 'react';
import { Box, Text, useStdin } from 'ink';
import Conf from 'conf';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import FormData from 'form-data';
import { io } from 'socket.io-client';

const conf = new Conf({
	projectName: 'queuebit',
	defaults: {
		apiKey: '',
		model: 'gemini-3-flash-preview'
	}
});

const api = axios.create({
	baseURL: 'http://localhost:3000',
	timeout: 30000,
	headers: {
		'Content-Type': 'application/json'
	}
});

api.interceptors.request.use((requestConfig) => {
	const apiKey = conf.get('apiKey');
	const model = conf.get('model');
	if (apiKey) {
		requestConfig.headers['X-API-Key'] = apiKey;
	}
	if (model) {
		requestConfig.headers['X-Model'] = model;
	}
	return requestConfig;
});

const LOGO = [
	' ██████╗ ██╗   ██╗███████╗██╗   ██╗███████╗██████╗ ██╗████████╗',
	'██╔═══██╗██║   ██║██╔════╝██║   ██║██╔════╝██╔══██╗██║╚══██╔══╝',
	'██║   ██║██║   ██║█████╗  ██║   ██║█████╗  ██████╔╝██║   ██║   ',
	'██║▄▄ ██║██║   ██║██╔══╝  ██║   ██║██╔══╝  ██╔══██╗██║   ██║   ',
	'╚██████╔╝╚██████╔╝███████╗╚██████╔╝███████╗██████╔╝██║   ██║   ',
	' ╚══▀▀═╝  ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝╚═════╝ ╚═╝   ╚═╝   '
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const ROOT_COMMANDS = ['/upload ', '/model ', '/key ', '/clear', '/exit'];

const MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-2.5-flash'];

const Logo = memo(() => (
	<Box flexDirection="column" alignItems="center">
		{LOGO.map((line, i) => (
			<Text key={i} color="#06b6d4" bold>{line}</Text>
		))}
	</Box>
));

export default function App() {
	const [query, setQuery] = useState('');
	const [mode, setMode] = useState('idle');
	const [uploadState, setUploadState] = useState({ status: '', jobId: '', result: null, error: null });
	const [output, setOutput] = useState([]);
	const [cursorIndex, setCursorIndex] = useState(0);
	const [showDropdown, setShowDropdown] = useState(false);
	const [dropdownItems, setDropdownItems] = useState([]);
	const [spinnerFrame, setSpinnerFrame] = useState(0);
	const spinnerRef = useRef(null);
	const socketRef = useRef(null);
	const { setRawMode } = useStdin();

	const terminalHeight = useMemo(() => process.stdout.rows || 24, []);
	const activeModel = useMemo(() => conf.get('model') || 'gemini-3-flash-preview', []);

	const filteredCommands = useMemo(() => {
		if (query.startsWith('/model ')) {
			const filter = query.replace('/model ', '').toLowerCase();
			return MODELS.filter(m => m.toLowerCase().includes(filter));
		}
		if (query.startsWith('/')) {
			const filter = query.slice(1).toLowerCase();
			return ROOT_COMMANDS.filter(cmd => cmd.replace('/', '').startsWith(filter));
		}
		return [];
	}, [query]);

	useEffect(() => {
		if (mode === 'processing' || mode === 'uploading') {
			spinnerRef.current = setInterval(() => setSpinnerFrame(f => (f + 1) % SPINNER_FRAMES.length), 80);
		}
		return () => { if (spinnerRef.current) clearInterval(spinnerRef.current); };
	}, [mode]);

	useEffect(() => {
		socketRef.current = io('http://localhost:3000', {
			transports: ['websocket'],
			reconnection: true
		});

		socketRef.current.on('job_updated', (data) => {
			const { jobId, status, extractedData, errorMessage } = data;
			if (status === 'completed') {
				setMode('result');
				setUploadState({ status: 'completed', jobId, result: extractedData, error: null });
				addOutput('Job completed!', 'green');
			} else if (status === 'failed') {
				setMode('idle');
				setUploadState({ status: 'failed', jobId, result: null, error: errorMessage });
				addOutput(`Job failed: ${errorMessage || 'Unknown error'}`, 'red');
			}
		});

		return () => {
			if (socketRef.current) {
				socketRef.current.disconnect();
			}
		};
	}, []);

	const addOutput = (text, color = 'white') => setOutput(prev => [...prev, { text, color, id: Date.now() + Math.random() }]);

	useEffect(() => {
		if (query.startsWith('/model ') || query.startsWith('/')) {
			setDropdownItems(filteredCommands);
			setShowDropdown(filteredCommands.length > 0);
		} else {
			setShowDropdown(false);
		}
		setCursorIndex(0);
	}, [query, filteredCommands]);

	const selectFromDropdown = () => {
		const selected = filteredCommands[cursorIndex] || filteredCommands[0];
		if (selected) {
			const newValue = query.startsWith('/model ') ? '/model ' + selected + ' ' : selected;
			setQuery(newValue);
			setShowDropdown(false);
		}
	};

	const executeCommand = () => {
		const trimmed = query.trim();
		
		if (trimmed.startsWith('/model ')) {
			const model = trimmed.replace('/model ', '').trim();
			if (model && MODELS.includes(model)) {
				conf.set('model', model);
				setQuery('');
				addOutput(`Model set to: ${model}`, 'green');
			} else if (model) {
				addOutput(`Invalid model: ${model}`, 'red');
			}
			return;
		}
		
		if (trimmed.startsWith('/key ')) {
			const key = trimmed.replace('/key ', '').trim();
			if (key) {
				conf.set('apiKey', key);
				setQuery('');
				addOutput('API key saved!', 'green');
			}
			return;
		}
		
		if (trimmed === '/clear') {
			setQuery('');
			setOutput([]);
			addOutput('Terminal cleared', 'gray');
			return;
		}
		
		if (trimmed === '/exit') {
			process.exit(0);
			return;
		}
		
		if (trimmed.startsWith('/upload ')) {
			const filePath = trimmed.replace('/upload ', '').trim();
			if (!filePath) { addOutput('Usage: /upload <path>', 'red'); return; }
			const resolvedPath = path.resolve(filePath);
			if (!fs.existsSync(resolvedPath)) { addOutput(`File not found: ${resolvedPath}`, 'red'); return; }
			if (!conf.get('apiKey')) { addOutput('API key not set. Use /key <your-key>', 'red'); return; }
			
			setMode('uploading');
			setUploadState({ status: 'uploading', jobId: '', result: null, error: null });
			setQuery('');
			
			const form = new FormData();
			form.append('document', fs.createReadStream(resolvedPath));
			form.append('model', conf.get('model'));
			
			api.post('/api/upload', form, { headers: form.getHeaders() })
				.then(res => {
					const jobId = res.data.jobId;
					setMode('processing');
					setUploadState({ status: 'processing', jobId, result: null, error: null });
					addOutput(`Uploading: ${filePath}`, 'blue');
					addOutput(`Job ID: ${jobId}`, 'yellow');
				})
				.catch(err => { setMode('idle'); addOutput(`Upload failed: ${err.message}`, 'red'); });
			return;
		}
		
		if (trimmed) addOutput(`Unknown command: ${trimmed}`, 'red');
	};

	const returnToInput = () => { setMode('idle'); setUploadState({ status: '', jobId: '', result: null, error: null }); setOutput([]); };

	useEffect(() => {
		setRawMode(true);
		
		const handleData = (data) => {
			const buf = Buffer.from(data);
			
			if (mode === 'result') {
				if (buf[0] === 0x1b) {
					returnToInput();
				}
				return;
			}
			
			if (mode !== 'idle') return;
			
			if (buf[0] === 0x03) {
				process.exit(0);
				return;
			}
			
			if (buf[0] === 0x1b) {
				if (buf[1] === 0x5b) {
					if (buf[2] === 0x41) {
						if (showDropdown && filteredCommands.length > 0) {
							setCursorIndex(prev => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
						}
					} else if (buf[2] === 0x42) {
						if (showDropdown && filteredCommands.length > 0) {
							setCursorIndex(prev => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
						}
					}
				} else if (buf[1] === undefined) {
					setShowDropdown(false);
				}
				return;
			}
			
			if (buf[0] === 0x7f || buf[0] === 0x08) {
				setQuery(prev => prev.slice(0, -1));
				return;
			}
			
			if (buf[0] === 0x09) {
				if (showDropdown && filteredCommands.length > 0) {
					selectFromDropdown();
				}
				return;
			}
			
			if (buf[0] === 0x0d || buf[0] === 0x0a) {
				if (showDropdown && filteredCommands.length > 0) {
					selectFromDropdown();
				} else {
					executeCommand();
				}
				return;
			}
			
			const char = buf.toString('utf8');
			if (char.length === 1 && char >= ' ' && char !== '\x7f') {
				setQuery(prev => prev + char);
			}
		};
		
		process.stdin.on('data', handleData);
		return () => {
			process.stdin.removeListener('data', handleData);
			setRawMode(false);
		};
	}, [mode, showDropdown, filteredCommands, cursorIndex, query]);

	const renderInputBox = () => (
		<Box width={80} flexDirection="column">
			<Box borderStyle="round" borderColor={showDropdown ? 'cyan' : 'gray'} backgroundColor="#1E1B2E">
				<Text color="gray">▌</Text>
				<Box flexGrow={1}>
					<Text color="white">{query || ''}<Text color="gray">{query ? '' : 'Type / for commands...'}</Text></Text>
				</Box>
			</Box>
			{showDropdown && filteredCommands.length > 0 && (
				<Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="gray" backgroundColor="#1E1B2E">
					{filteredCommands.map((item, index) => (
						<Box key={index} paddingX={1} backgroundColor={index === cursorIndex ? '#06b6d4' : 'transparent'}>
							<Text color={index === cursorIndex ? 'black' : 'gray'} bold={index === cursorIndex}>
								{index === cursorIndex ? '▶ ' : '  '}{item}
							</Text>
						</Box>
					))}
				</Box>
			)}
		</Box>
	);

	const renderProcessingBox = () => (
		<Box width={80} borderStyle="round" borderColor="yellow" backgroundColor="#1E1B2E">
			<Text color="yellow">{SPINNER_FRAMES[spinnerFrame]}</Text>
			<Text color="white">  </Text>
			<Text color="yellow">{mode === 'uploading' ? 'Uploading...' : `Processing... Job ID: ${uploadState.jobId.substring(0, 8)}...`}</Text>
		</Box>
	);

	const renderResultBox = () => (
		<Box flexDirection="column" width={80} borderStyle="round" borderColor="green" backgroundColor="#1E1B2E" paddingX={1}>
			<Text color="green" bold>✓ Job Completed</Text>
			<Text color="gray">Job ID: {uploadState.jobId}</Text>
			<Text color="gray">{'─'.repeat(50)}</Text>
			<Text color="cyan">{JSON.stringify(uploadState.result, null, 2)}</Text>
			<Text color="gray">{'─'.repeat(50)}</Text>
			<Text color="gray">Press Escape to return</Text>
		</Box>
	);

	const StatusBar = memo(() => (
		<Box width={80} justifyContent="space-between" marginTop={1}>
			<Text color="cyan" bold>⚡ QueueBit Core</Text>
			<Text color="magenta">Model: {activeModel}</Text>
			<Text color="green">Status: Online</Text>
		</Box>
	));

	const Footer = memo(() => (
		<Box width="100%" flexDirection="column" alignItems="center" justifyContent="flex-end" height={3}>
			<Box width="100%" flexDirection="row" justifyContent="flex-end">
				<Text color="gray">↑↓ navigate  Tab complete  Enter select</Text>
			</Box>
			<Box flexDirection="row" alignItems="center" marginTop={1}>
				<Text color="yellow">•</Text>
				<Text color="gray">  Tip: Type /upload &lt;path&gt; to queue a document extraction</Text>
			</Box>
		</Box>
	));

	return (
		<Box flexDirection="column" alignItems="center" width="100%" height={terminalHeight} backgroundColor="#13111C">
			<Box flexDirection="column" alignItems="center" flexGrow={1} justifyContent="center">
				<Logo />
				<Box marginTop={1}>
					{mode === 'idle' && renderInputBox()}
					{(mode === 'uploading' || mode === 'processing') && renderProcessingBox()}
					{mode === 'result' && renderResultBox()}
				</Box>
				<StatusBar />
			</Box>
			{mode === 'idle' && (
				<>
					<Box flexDirection="column" width={80} marginTop={1} flexGrow={1}>
						{output.slice(-15).map(item => <Text key={item.id} color={item.color === 'white' ? '#e4e4e7' : item.color === 'green' ? '#22c55e' : item.color === 'red' ? '#ef4444' : item.color === 'yellow' ? '#f59e0b' : item.color === 'blue' ? '#3b82f6' : '#71717a'}>{item.text}</Text>)}
					</Box>
					<Footer />
				</>
			)}
		</Box>
	);
}

// The creatures that close in on you. `e` is the emoji drawn on screen, `n` is the
// name you key in Words mode. No name is a prefix of another, so a finished name
// is never ambiguous (keying BAT can't be the start of something longer).
const CREATURES = [
  // 3 letters
  { e: '🦇', n: 'BAT' },
  { e: '🐀', n: 'RAT' },
  { e: '🦉', n: 'OWL' },
  { e: '🐜', n: 'ANT' },
  { e: '🐝', n: 'BEE' },
  { e: '🪰', n: 'FLY' },
  { e: '👿', n: 'IMP' },
  { e: '🦖', n: 'REX' },
  { e: '🦊', n: 'FOX' },
  { e: '🧝', n: 'ELF' },
  { e: '🐛', n: 'BUG' },
  // 4 letters
  { e: '👹', n: 'OGRE' },
  { e: '🦀', n: 'CRAB' },
  { e: '🐺', n: 'WOLF' },
  { e: '🐗', n: 'BOAR' },
  { e: '🐻', n: 'BEAR' },
  { e: '🦟', n: 'GNAT' },
  { e: '🐊', n: 'CROC' },
  { e: '🧙', n: 'MAGE' },
  { e: '💩', n: 'POOP' },
  // 5 letters
  { e: '👻', n: 'GHOST' },
  { e: '💀', n: 'SKULL' },
  { e: '👽', n: 'ALIEN' },
  { e: '🤖', n: 'ROBOT' },
  { e: '🤡', n: 'CLOWN' },
  { e: '🐍', n: 'SNAKE' },
  { e: '🦈', n: 'SHARK' },
  { e: '🦑', n: 'SQUID' },
  { e: '🧞', n: 'GENIE' },
  { e: '🧌', n: 'TROLL' },
  // 6+ letters
  { e: '🧟', n: 'ZOMBIE' },
  { e: '🕷️', n: 'SPIDER' },
  { e: '🐉', n: 'DRAGON' },
  { e: '👺', n: 'GOBLIN' },
  { e: '🦎', n: 'LIZARD' },
  { e: '🧛', n: 'VAMPIRE' },
  { e: '🐙', n: 'OCTOPUS' },
  { e: '🎃', n: 'PUMPKIN' },
  { e: '🦂', n: 'SCORPION' },
  { e: '🦕', n: 'DINOSAUR' }
];

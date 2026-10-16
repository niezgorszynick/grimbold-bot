// public/auctions.js — The Auctions tab: running auctions with a bid form,
// selling one of your characters' magic items, and recent results.

(function () {
  const root = document.getElementById('auctions');
  if (!root) return;

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key === 'onclick') node.addEventListener('click', value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    [].concat(children || []).forEach(child => {
      if (child === null || child === undefined || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }
  const gp = cp => {
    const value = cp / 100;
    return (Number.isInteger(value) ? value.toLocaleString('en-US') : value.toFixed(2)) + ' gp';
  };
  function timeLeft(endsAt) {
    const ms = Date.parse(endsAt) - Date.now();
    if (ms <= 0) return 'closing now';
    const hours = Math.floor(ms / 3600000);
    return hours >= 48 ? Math.floor(hours / 24) + ' days left' : hours >= 1 ? hours + ' h left' : Math.max(1, Math.floor(ms / 60000)) + ' min left';
  }

  let data = null;
  let message = '';
  let isError = false;

  async function api(url, payload) {
    const response = await fetch(url, {
      method: payload ? 'POST' : 'GET',
      headers: payload ? { 'Content-Type': 'application/json' } : {},
      body: payload ? JSON.stringify(payload) : undefined
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Something went wrong.');
    return result;
  }

  async function act(run, success) {
    try {
      await run();
      message = success;
      isError = false;
    } catch (error) {
      message = error.message;
      isError = true;
    }
    await load();
  }

  const characterSelect = (characters, label) => {
    const select = el('select', { 'aria-label': label });
    characters.forEach(character => select.add(new Option(character.name + ' (' + gp(character.gold_cp) + ')', String(character.id))));
    return select;
  };

  function bidForm(auction) {
    const mine = data.characters.filter(() => auction.sellerPlayerId !== data.viewerId);
    if (!mine.length) return null;
    const who = characterSelect(mine, 'Bid as');
    const amount = el('input', { type: 'number', min: String(auction.nextBidCp / 100), step: '1', value: String(auction.nextBidCp / 100), 'aria-label': 'Bid in gold pieces', className: 'auction-amount' });
    return el('div', { className: 'vitals-actions' }, [
      who, amount, el('span', { className: 'muted small', text: 'gp' }),
      el('button', {
        type: 'button', className: 'btn btn-small btn-gold', text: 'Bid',
        onclick: () => act(() => api('/api/auctions/' + auction.id + '/bid', { characterId: Number(who.value), amountGp: amount.value }), 'Bid placed on ' + auction.item + '.')
      })
    ]);
  }

  function auctionCard(auction) {
    const mineToWithdraw = (auction.sellerPlayerId === data.viewerId && !auction.currentBidCp) || data.canManage;
    return el('article', { className: 'card auction-card' }, [
      el('header', { className: 'auction-head' }, [
        el('div', {}, [
          el('h4', { text: auction.item }),
          el('div', { className: 'muted small', text: auction.rarity + ' · worth about ' + gp(auction.valueCp) + ' · sold by ' + auction.seller + (auction.sellerPlayer ? ' (' + auction.sellerPlayer + ')' : '') })
        ]),
        el('span', { className: 'tag', text: timeLeft(auction.endsAt) })
      ]),
      el('p', {}, auction.currentBidCp
        ? ['Highest bid ', el('strong', { text: gp(auction.currentBidCp) }), ' by ', el('strong', { text: auction.highestBidder }), ' · next bid at least ' + gp(auction.nextBidCp)]
        : ['No bids yet · opening bid ', el('strong', { text: gp(auction.openingBidCp) })]),
      bidForm(auction),
      auction.bids.length ? el('details', { className: 'auction-bids' }, [
        el('summary', { text: auction.bids.length + ' bid' + (auction.bids.length === 1 ? '' : 's') }),
        el('ul', {}, auction.bids.map(bid => el('li', { className: 'small', text: gp(bid.amountCp) + ' — ' + bid.by + ' (' + new Date(bid.at).toLocaleString() + ')' })))
      ]) : null,
      mineToWithdraw ? el('button', {
        type: 'button', className: 'btn btn-small btn-secondary', text: auction.currentBidCp ? 'Withdraw (DM: the bid is returned)' : 'Withdraw',
        onclick: () => { if (window.confirm('Withdraw ' + auction.item + ' from the auction?')) act(() => api('/api/auctions/' + auction.id + '/cancel', {}), auction.item + ' was withdrawn.'); }
      }) : null
    ]);
  }

  function sellForm() {
    if (!data.characters.length) return el('p', { className: 'muted small', text: 'You need a living character to sell anything.' });
    const who = characterSelect(data.characters, 'Seller');
    const item = el('select', { 'aria-label': 'Item to sell' });
    const info = el('span', { className: 'muted small' });
    const sell = el('button', { type: 'button', className: 'btn btn-small btn-green', text: 'Put up for auction', disabled: true });
    let items = [];
    async function loadItems() {
      item.replaceChildren(new Option('Loading…', ''));
      sell.disabled = true;
      try {
        items = (await api('/api/auctions/sellable/' + who.value)).items;
      } catch {
        items = [];
      }
      item.replaceChildren(new Option(items.length ? '-- Choose a magic item --' : 'No magic items', ''));
      items.forEach(entry => item.add(new Option(entry.name + (entry.quantity > 1 ? ' (1 of ' + entry.quantity + ')' : '') + ' — ' + entry.rarity, entry.uid)));
      info.textContent = '';
    }
    who.addEventListener('change', loadItems);
    item.addEventListener('change', () => {
      const chosen = items.find(entry => entry.uid === item.value);
      sell.disabled = !chosen;
      info.textContent = chosen ? 'Opening bid ' + gp(Math.max(100, Math.round(chosen.valueCp / 200) * 100)) + (chosen.attuned ? ' · attunement ends' : '') : '';
    });
    sell.addEventListener('click', () => {
      const chosen = items.find(entry => entry.uid === item.value);
      if (!chosen || !window.confirm('Put ' + chosen.name + ' up for auction for ' + data.days + ' days? It leaves ' + who.options[who.selectedIndex].text.replace(/ \(.*$/, '') + "'s sheet until the auction ends.")) return;
      act(() => api('/api/auctions', { characterId: Number(who.value), uid: chosen.uid }), chosen.name + ' is up for auction.');
    });
    loadItems();
    return el('div', { className: 'vitals-actions' }, [who, item, sell, info]);
  }

  function resultLine(auction) {
    const result = auction.result || {};
    const text = auction.status === 'withdrawn' ? 'withdrawn'
      : auction.status === 'unsold' ? 'no bids: Grimbold paid ' + gp(result.sellerGetsCp || 0)
        : 'to ' + result.winner + ' for ' + gp(result.priceCp || 0);
    return el('li', {}, [el('strong', { text: auction.item }), ' — ' + text + ' ', el('span', { className: 'muted small', text: '(' + auction.seller + ', ' + String(auction.closedAt || '').slice(0, 10) + ')' })]);
  }

  function render() {
    root.replaceChildren(...[
      message ? el('p', { className: 'sheet-message' + (isError ? ' is-error' : ''), role: 'status', text: message }) : null,
      el('section', { className: 'card' }, [el('h3', { text: 'Sell an item' }), sellForm()]),
      el('h3', { text: 'Up for auction (' + data.open.length + ')' }),
      data.open.length ? el('div', { className: 'auction-grid' }, data.open.map(auctionCard)) : el('p', { className: 'muted', text: 'Nothing up for auction right now.' }),
      data.closed.length ? el('section', { className: 'card' }, [el('h3', { text: 'Recent results' }), el('ul', { className: 'auction-results' }, data.closed.map(resultLine))]) : null
    ].filter(Boolean));
  }

  async function load() {
    try {
      data = await api('/api/auctions');
    } catch (error) {
      root.replaceChildren(el('p', { className: 'sheet-message is-error', text: error.message }));
      return;
    }
    render();
  }

  load();
})();

const products=[
 {
  name:'PayWeb — Payment Landing Page',
  description:'A clean static payment page template for UPI and international payment methods, built with HTML, Tailwind CSS and vanilla JavaScript.',
  category:'website',
  price:'₹99',
  short:'PAYWEB',
  image:'assets/payweb-banner.svg',
  url:'payweb.html'
 },
 {
  name:'ShortLink Bot — Telegram URL Shortener',
  description:'Telegram bot source code that converts submitted links through a connected custom URL shortener, with auth, logs, broadcast and admin features.',
  category:'telegram',
  price:'Contact',
  short:'SHORTLINK',
  image:'assets/shortlink-bot-banner.svg',
  url:'shortlink-bot.html'
 }
];

const productGrid=document.getElementById('products');
const search=document.getElementById('search');
const category=document.getElementById('category');

function renderProducts(){
 const q=(search?.value||'').toLowerCase();
 const cat=category?.value||'all';
 const list=products.filter(p=>(cat==='all'||p.category===cat)&&(!q||[p.name,p.description,p.category].join(' ').toLowerCase().includes(q)));
 if(!list.length){productGrid.innerHTML='<div class="empty"><strong>No matching products.</strong><span>Try another search or category.</span></div>';return}
 productGrid.innerHTML=list.map(p=>'<article class="product">'+
   '<a href="'+p.url+'" class="product-cover" style="display:block;padding:0;overflow:hidden"><img src="'+p.image+'" alt="'+p.name+'" style="display:block;width:100%;height:auto"></a>'+
   '<div class="product-body"><h3>'+p.name+'</h3><p>'+p.description+'</p><div class="product-meta"><span class="price">'+p.price+'</span><a class="button primary" href="'+p.url+'">View</a></div></div>'+
  '</article>').join('');
}
search?.addEventListener('input',renderProducts);
category?.addEventListener('change',renderProducts);
renderProducts();
document.getElementById('year').textContent=new Date().getFullYear();
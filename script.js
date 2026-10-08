const products=[];

const productGrid=document.getElementById('products');
const search=document.getElementById('search');
const category=document.getElementById('category');

function renderProducts(){
 const q=(search?.value||'').toLowerCase();
 const cat=category?.value||'all';
 const list=products.filter(p=>(cat==='all'||p.category===cat)&&(!q||[p.name,p.description,p.category].join(' ').toLowerCase().includes(q)));
 if(!list.length){productGrid.innerHTML='<div class="empty"><strong>Shop is getting ready.</strong><span>New FAROFF code products will appear here soon.</span></div>';return}
 productGrid.innerHTML=list.map(p=>'<article class="product"><div class="product-cover">'+p.short+'</div><div class="product-body"><h3>'+p.name+'</h3><p>'+p.description+'</p><div class="product-meta"><span class="price">'+p.price+'</span><a class="button primary" href="'+p.url+'">View</a></div></div></article>').join('');
}
search?.addEventListener('input',renderProducts);category?.addEventListener('change',renderProducts);renderProducts();
document.getElementById('year').textContent=new Date().getFullYear();
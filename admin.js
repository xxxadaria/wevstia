
const DEFAULT_SUPABASE_URL = 'https://qlenulpcvbwntvfiznbz.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_UdRnJVbhXNvhdomlQo2_DQ_MyVGxJdA';

async function loadRuntimeConfig() {
  try {
    const response = await fetch('/config');
    if (!response.ok) throw new Error('Runtime config is unavailable');
    return await response.json();
  } catch (error) {
    console.warn('Using default Supabase config');
    return {};
  }
}

function createSupabaseClient(config = {}) {
  const { createClient } = supabase;
  const supabaseUrl = config.supabaseUrl || DEFAULT_SUPABASE_URL;
  const supabaseAnonKey = config.supabaseAnonKey || DEFAULT_SUPABASE_ANON_KEY;
  return createClient(supabaseUrl, supabaseAnonKey);
}

class AdminDashboard {
  constructor(supabaseClient) {
    this.currentUser = null;
    this.products = [];
    this.orders = [];
    this.customers = [];
    this.activeSection = 'dashboard';
    this.realtimeChannels = [];
    this.refreshTimers = {};
    this.supabase = supabaseClient;
    this.init();
  }

    async init() {
        console.log('🚀 Toys R Us Admin - Supabase подключен!');
        await this.testConnection();
        this.initAll();
    }

    // подключения
    async testConnection() {
        try {
            const { data } = await this.supabase.from('products').select('id').limit(1);
            console.log('БД OK!', data?.length || 0, 'продуктов');
        } catch (e) {
            console.warn('проверь БД');
        }
    }

    initAll() {
        this.initLogin();
        this.initNavigation();
        this.initModals();
        this.initFilters();
        this.setupRealtimeSync();
        this.updateTime();
        setInterval(() => this.updateTime(), 1000);
    }

    setupRealtimeSync() {
        this.subscribeToTable('products', () => {
            this.loadDashboardData();
            this.loadInventory();
            if (this.activeSection === 'products') this.loadProducts();
        });

        this.subscribeToTable('orders', () => {
            this.loadDashboardData();
            if (this.activeSection === 'orders') this.loadAllOrders();
        });

        this.subscribeToTable('customers', () => {
            if (this.activeSection === 'users') this.loadCustomers();
        });

        window.addEventListener('beforeunload', () => this.unsubscribeAll());
    }

    subscribeToTable(tableName, onChange) {
        const channel = this.supabase
            .channel(`realtime:${tableName}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: tableName },
                () => this.scheduleRefresh(tableName, onChange)
            )
            .subscribe((status) => {
                if (status === 'SUBSCRIBED') {
                    console.log(`Realtime synced: ${tableName}`);
                }
            });

        this.realtimeChannels.push(channel);
    }

    scheduleRefresh(tableName, callback) {
        clearTimeout(this.refreshTimers[tableName]);
        this.refreshTimers[tableName] = setTimeout(() => {
            callback();
        }, 250);
    }

    unsubscribeAll() {
        this.realtimeChannels.forEach(channel => {
            this.supabase.removeChannel(channel);
        });
        this.realtimeChannels = [];
    }

    // логин
    initLogin() {
        document.getElementById('loginForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const pass = document.getElementById('loginPassword').value;
            
            if (email === 'admin@toysrus.com' && pass === 'toys2024') {
                this.currentUser = { email, name: 'Admin' };
                document.getElementById('currentUser').textContent = email;
                document.getElementById('welcomeText').textContent = 'Добро пожаловать!';
                document.getElementById('loginModal').style.display = 'none';
                document.body.classList.add('dashboard-ready');
                this.loadDashboardData();
            } else {
                alert('Логин: admin@toysrus.com\nПароль: toys2024');
            }
        });
    }

    // дешборд
    async loadDashboardData() {
        try {
            // заказы
            const { data: orders } = await this.supabase
                .from('orders')
                .select('region,total')
                .limit(50);
            
            const ruCount = orders?.filter(o => o.region === 'RU').length || 0;
            const usCount = orders?.filter(o => o.region === 'US').length || 0;
            
            document.getElementById('ruOrders').textContent = ruCount;
            document.getElementById('usOrders').textContent = usCount;
            
            // выручка
            const ruRevenue = orders?.filter(o => o.region === 'RU')
                .reduce((sum, o) => sum + (o.total || 0), 0) || 0;
            document.getElementById('totalRevenue').textContent = `$${Math.round(ruRevenue/95).toLocaleString()}`;
            
            // продукты
            const { count } = await this.supabase
                .from('products').select('*', { count: 'exact', head: true });
            document.getElementById('totalProducts').textContent = count || 0;
            
            this.loadRecentOrders();
        } catch (e) {
            console.error('Dashboard:', e);
        }
    }

    async loadRecentOrders() {
        try {
            const { data: orders } = await this.supabase
                .from('orders')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(6);
            
            const tbody = document.querySelector('#ordersTable tbody');
            tbody.innerHTML = orders?.map(order => {
                const status = order.status || 'new';
                return `
                    <tr>
                        <td>#${order.id?.slice(-4)}</td>
                        <td>${order.customer_name}</td>
                        <td>${order.total?.toLocaleString()} ${order.currency || '₽'}</td>
                        <td>${order.region}</td>
                        <td><span class="status ${status}">${status.toUpperCase()}</span></td>
                        <td>${new Date(order.created_at).toLocaleDateString()}</td>
                        <td><button class="btn btn-edit">👁️</button></td>
                    </tr>
                `;
            }).join('') || '<tr><td colspan="7">Нет заказов</td></tr>';
        } catch (e) {
            console.error(e);
        }
    }

    // продуктыCRUD
    async loadProducts() {
        try {
            const { data } = await this.supabase
                .from('products')
                .select('*')
                .order('created_at', { ascending: false });
            
            this.products = data || [];
            document.getElementById('productsCount').textContent = this.products.length;
            
            const tbody = document.querySelector('#productsTable tbody');
            tbody.innerHTML = this.products.map(p => `
                <tr>
                    <td>#${p.id?.slice(-4)}</td>
                    <td><img src="${p.image || 'https://via.placeholder.com/50'}" style="width:50px;height:50px;border-radius:8px;"></td>
                    <td>${p.name}</td>
                    <td>₽${p.price_ru?.toLocaleString()}<br>$${p.price_us?.toLocaleString()}</td>
                    <td>${p.stock_ru || 0}</td>
                    <td>${p.stock_us || 0}</td>
                    <td><span class="status ${p.status || 'active'}">${p.status?.toUpperCase()}</span></td>
                    <td>
                        <button class="btn btn-edit" onclick="admin.editProduct('${p.id}')">✏️</button>
                        <button class="btn btn-delete" onclick="admin.deleteProduct('${p.id}')">🗑️</button>
                    </td>
                </tr>
            `).join('') || '<tr><td colspan="8">нет продуктов</td></tr>';
        } catch (e) {
            console.error('Products:', e);
        }
    }

    async addProduct(data) {
        const { error } = await this.supabase.from('products').insert([data]);
        if (error) throw error;
    }

    async updateProduct(id, data) {
        const { error } = await this.supabase.from('products').update(data).eq('id', id);
        if (error) throw error;
    }

    async deleteProduct(id) {
        if (confirm('удалить продукт?')) {
            const { error } = await this.supabase.from('products').delete().eq('id', id);
            if (!error) {
                this.loadProducts();
                alert('✅ удалено!');
            }
        }
    }

    editProduct(id) {
        const product = this.products.find(p => p.id === id);
        if (!product) return alert('продукт не найден');

        document.getElementById('editProductId').value = id;
        document.getElementById('productModalTitle').textContent = '✏️ редактировать';
        document.getElementById('productName').value = product.name;
        document.getElementById('productImage').value = product.image || '';
        document.getElementById('productPriceRu').value = product.price_ru || 0;
        document.getElementById('productPriceUs').value = product.price_us || 0;
        document.getElementById('stockRu').value = product.stock_ru || 0;
        document.getElementById('stockUs').value = product.stock_us || 0;
        document.getElementById('productCategory').value = product.category || '';
        document.getElementById('productStatus').value = product.status || 'active';
        
        document.getElementById('productModal').style.display = 'block';
    }

    // клиенты
    async loadCustomers() {
        try {
            const { data } = await this.supabase.from('customers').select('*');
            document.getElementById('usersCount').textContent = data?.length || 0;
            
            const tbody = document.querySelector('#usersTable tbody');
            tbody.innerHTML = data?.map(c => `
                <tr>
                    <td>#${c.id?.slice(-4)}</td>
                    <td>${c.name}</td>
                    <td>${c.email}</td>
                    <td>${c.region}</td>
                    <td>${c.total_orders || 0}</td>
                    <td>$${c.total_spent?.toLocaleString()}</td>
                </tr>
            `).join('') || '<tr><td colspan="6">нет клиентов</td></tr>';
        } catch (e) {
            console.error(e);
        }
    }

    // заказы
    async loadAllOrders() {
        try {
            const region = document.getElementById('ordersRegionFilter').value;
            let query = this.supabase.from('orders').select('*').order('created_at', { ascending: false });
            
            if (region) query = query.eq('region', region);
            
            const { data } = await query;
            const tbody = document.querySelector('#allOrdersTable tbody');
            tbody.innerHTML = data?.map(o => `
                <tr>
                    <td>#${o.id?.slice(-4)}</td>
                    <td>${o.customer_name}</td>
                    <td>${o.items_count || 1}</td>
                    <td>${o.total?.toLocaleString()} ${o.currency}</td>
                    <td>${o.region}</td>
                    <td><span class="status ${o.status}">${o.status?.toUpperCase()}</span></td>
                    <td><button class="btn btn-ship">🚚</button></td>
                </tr>
            `).join('') || '<tr><td colspan="7">нет заказов</td></tr>';
        } catch (e) {
            console.error(e);
        }
    }

    // иnventory
    async loadInventory() {
        try {
            const { data } = await this.supabase.from('products').select('*');
            const tbody = document.querySelector('#inventoryTable tbody');
            tbody.innerHTML = data?.map(p => `
                <tr>
                    <td>${p.name}</td>
                    <td>${p.stock_ru || 0}</td>
                    <td>${p.stock_us || 0}</td>
                    <td>10</td>
                    <td class="${(p.stock_ru || 0) < 10 ? 'status low' : ''}">RU</td>
                    <td class="${(p.stock_us || 0) < 10 ? 'status low' : ''}">US</td>
                </tr>
            `).join('') || '<tr><td colspan="6">-</td></tr>';
        } catch (e) {
            console.error(e);
        }
    }

    // навигация
    initNavigation() {
        document.querySelectorAll('.nav-admin a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = link.getAttribute('href').slice(1);
                this.showSection(section);
            });
        });
    }

    showSection(id) {
        this.activeSection = id;
        document.querySelectorAll('section').forEach(s => s.style.display = 'none');
        document.getElementById(id).style.display = 'block';
        document.getElementById('pageTitle').textContent = id.charAt(0).toUpperCase() + id.slice(1);
        
        document.querySelectorAll('.nav-admin a').forEach(a => a.classList.remove('active'));
        document.querySelector(`a[href="#${id}"]`).classList.add('active');
        
        // загрузка
        switch(id) {
            case 'products': this.loadProducts(); break;
            case 'orders': this.loadAllOrders(); break;
            case 'users': this.loadCustomers(); break;
            case 'inventory': this.loadInventory(); break;
        }
    }

    // модалы
    initModals() {
        document.getElementById('productForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('editProductId').value;
            const data = {
                name: document.getElementById('productName').value,
                image: document.getElementById('productImage').value,
                price_ru: parseFloat(document.getElementById('productPriceRu').value),
                price_us: parseFloat(document.getElementById('productPriceUs').value),
                stock_ru: parseInt(document.getElementById('stockRu').value),
                stock_us: parseInt(document.getElementById('stockUs').value),
                category: document.getElementById('productCategory').value,
                status: document.getElementById('productStatus').value
            };
            
            try {
                if (id) await this.updateProduct(id, data);
                else await this.addProduct(data);
                
                AdminDashboard.closeProductModal();
                this.loadProducts();
                alert('✅ сохранено!');
            } catch (e) {
                alert('ошибка');
            }
        });
    }

    initFilters() {
        document.getElementById('ordersRegionFilter')?.addEventListener('change', () => this.loadAllOrders());
    }

    updateTime() {
        document.getElementById('currentTime').textContent = new Date().toLocaleString('ru-RU');
    }

    // статические
    static openProductModal() {
        document.getElementById('productModal').style.display = 'block';
        document.getElementById('productModalTitle').textContent = '➕ новый продукт';
        document.getElementById('productForm').reset();
    }

    static closeProductModal() {
        document.getElementById('productModal').style.display = 'none';
    }

    static toggleSidebar() {
        document.getElementById('sidebar').classList.toggle('mobile-open');
    }

    logout() {
        document.getElementById('loginModal').style.display = 'flex';
    }
}

//запуск
let admin;

async function bootstrap() {
  const runtimeConfig = await loadRuntimeConfig();
  const supabaseClient = createSupabaseClient(runtimeConfig);
  admin = new AdminDashboard(supabaseClient);
}

bootstrap();

//глобальные функ
window.openProductModal = AdminDashboard.openProductModal.bind(AdminDashboard);
window.closeProductModal = AdminDashboard.closeProductModal.bind(AdminDashboard);
window.toggleSidebar = AdminDashboard.toggleSidebar.bind(AdminDashboard);
window.logout = () => admin?.logout();

// закрытие модала кликом вне
window.onclick = (e) => {
    if (e.target.id === 'productModal') AdminDashboard.closeProductModal();
};